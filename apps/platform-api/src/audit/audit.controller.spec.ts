import { BadRequestException } from '@nestjs/common';
import { StreamableFile } from '@nestjs/common';
import { AuditController } from './audit.controller';

function makeController() {
  const audit: any = {
    list: jest.fn().mockResolvedValue({ data: [], meta: {} }),
    detail: jest.fn().mockResolvedValue({ id: 'log-1' }),
    exportRows: jest
      .fn()
      .mockResolvedValue({ rows: [{ id: 'log-1' }], truncated: false }),
    toCsv: jest.fn().mockReturnValue('id\nlog-1\n'),
  };
  return { audit, controller: new AuditController(audit) };
}

describe('AuditController', () => {
  it('delegates list and detail', async () => {
    const { controller, audit } = makeController();

    await controller.list({ action: 'users' } as any);
    expect(audit.list).toHaveBeenCalledWith({ action: 'users' });

    await controller.detail('log-1');
    expect(audit.detail).toHaveBeenCalledWith('log-1');
  });

  it('exports CSV as a downloadable file', async () => {
    const { controller, audit } = makeController();

    const result = await controller.export({ format: 'csv' } as any);

    expect(audit.exportRows).toHaveBeenCalledWith({ format: 'csv' });
    expect(audit.toCsv).toHaveBeenCalledWith([{ id: 'log-1' }]);
    expect(result).toBeInstanceOf(StreamableFile);
    const options = (result as any).options;
    expect(options.type).toContain('text/csv');
    expect(options.disposition).toMatch(
      /attachment; filename="audit-export-\d{14}\.csv"/,
    );
  });

  it('exports JSON with the truncation flag', async () => {
    const { controller, audit } = makeController();
    audit.exportRows.mockResolvedValue({ rows: [], truncated: true });

    const result = await controller.export({ format: 'json' } as any);

    expect(result).toBeInstanceOf(StreamableFile);
    const options = (result as any).options;
    expect(options.type).toContain('application/json');
    expect(options.disposition).toMatch(/\.json"$/);
  });

  it('rejects unknown export formats', async () => {
    const { controller } = makeController();

    await expect(controller.export({ format: 'xml' } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
