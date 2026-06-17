import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConsignacionImportDto } from './consignacion.dto';

/** Hardening: la entrada del ERP se valida (tamaño/tipo) antes de procesar. */
async function errores(payload: unknown) {
  const dto = plainToInstance(ConsignacionImportDto, payload);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('ConsignacionImportDto', () => {
  const base = {
    snapshotTs: '2026-06-17T02:00:00.000Z',
    items: [{ nroCliente: 'C-10', isbn: '9780306406157', cantidad: 5 }],
  };

  it('acepta un snapshot válido', async () => {
    expect(await errores(base)).toHaveLength(0);
  });

  it('rechaza snapshotTs no ISO-8601', async () => {
    expect((await errores({ ...base, snapshotTs: 'ayer' })).length).toBeGreaterThan(0);
  });

  it('rechaza cantidad negativa', async () => {
    const malo = { ...base, items: [{ nroCliente: 'C-10', isbn: '978', cantidad: -1 }] };
    expect((await errores(malo)).length).toBeGreaterThan(0);
  });

  it('rechaza items vacío', async () => {
    expect((await errores({ ...base, items: [] })).length).toBeGreaterThan(0);
  });

  it('rechaza más de 5000 items', async () => {
    const items = Array.from({ length: 5001 }, () => ({ nroCliente: 'C', isbn: '978', cantidad: 1 }));
    expect((await errores({ ...base, items })).length).toBeGreaterThan(0);
  });
});
