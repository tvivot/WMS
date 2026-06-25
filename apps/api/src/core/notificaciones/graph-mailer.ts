import { Injectable, Logger } from '@nestjs/common';
import { leerO365Config, O365Config } from './notificaciones.config';
import { esEmailValido } from './plantilla';

const TOKEN_URL = (tenant: string) =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const SEND_URL = (from: string) =>
  `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`;

export interface MailMensaje {
  to: string[];
  asunto: string;
  cuerpo: string;
}

/**
 * Cliente mínimo de Microsoft Graph para enviar correo (app-only, client
 * credentials). Sin dependencias externas: usa fetch nativo (Node 18+).
 * Cachea el token en memoria hasta su expiración (con margen) para no pedir uno
 * por cada mail.
 */
@Injectable()
export class GraphMailer {
  private readonly logger = new Logger(GraphMailer.name);
  private token: { value: string; expiraEn: number } | null = null;

  /** true si hay credenciales O365 cargadas (si no, el envío queda inerte). */
  estaConfigurado(): boolean {
    return leerO365Config() !== null;
  }

  private async obtenerToken(cfg: O365Config): Promise<string> {
    // Margen de 60s para no usar un token a punto de vencer.
    if (this.token && this.token.expiraEn - 60_000 > Date.now()) {
      return this.token.value;
    }
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: GRAPH_SCOPE,
    });
    const res = await fetch(TOKEN_URL(cfg.tenantId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!res.ok || !data.access_token) {
      throw new Error(
        `No se pudo obtener token de Graph (${res.status}): ${data.error_description || 'sin detalle'}`,
      );
    }
    this.token = {
      value: data.access_token,
      expiraEn: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  /**
   * Envía un correo por Graph. Lanza si no está configurado o si Graph rechaza:
   * el llamador (servicio) captura y registra el error en el log para reintento.
   */
  async enviar(msg: MailMensaje): Promise<void> {
    const cfg = leerO365Config();
    if (!cfg) throw new Error('Office365 no configurado (faltan variables O365_*/MAIL_FROM)');
    const destinatarios = msg.to.filter((d) => esEmailValido(d));
    if (destinatarios.length === 0) throw new Error('Sin destinatarios válidos');

    const payload = {
      message: {
        subject: msg.asunto,
        body: { contentType: 'Text', content: msg.cuerpo },
        toRecipients: destinatarios.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: false,
    };

    // Un 401 suele ser token vencido/rotado: se invalida y se reintenta UNA vez
    // con token fresco antes de dar el envío por fallido (no gasta un reintento
    // del outbox por una causa transitoria recuperable en el acto).
    let res = await this.postSendMail(cfg, payload);
    if (res.status === 401) {
      this.token = null;
      res = await this.postSendMail(cfg, payload);
    }
    if (!res.ok) {
      if (res.status === 401) this.token = null;
      const txt = await res.text().catch(() => '');
      throw new Error(`Graph sendMail falló (${res.status}): ${txt.slice(0, 300)}`);
    }
  }

  private async postSendMail(cfg: O365Config, payload: unknown): Promise<Response> {
    const token = await this.obtenerToken(cfg);
    return fetch(SEND_URL(cfg.from), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }
}
