import { MailConnection } from './entities/mail-connection.entity';
import { MailSender } from './entities/mail-sender.entity';
import { GmailClientService } from './gmail/gmail-client.service';
import { MailConnectionsService } from './mail-connections.service';
import { MailIngestionService } from './mail-ingestion.service';
import { MailSendersService } from './mail-senders.service';
import { MailSyncService } from './mail-sync.service';

const connection = {
  id: 'conn-1',
  userId: 'user-1',
  historyId: '100',
  lastSyncedAt: new Date('2026-09-20T00:00:00Z'),
} as MailConnection;
const sender = { id: 's1', emailAddress: 'f@d1.com.co' } as MailSender;

function setup(gmail: Partial<Record<string, jest.Mock>>, ingest?: jest.Mock) {
  const connections = {
    gmailFor: jest.fn(() => ({})),
    markSynced: jest.fn(),
    recordFailure: jest.fn(),
  };
  const ingestion = { ingest: ingest ?? jest.fn().mockResolvedValue(null) };
  const service = new MailSyncService(
    connections as unknown as MailConnectionsService,
    {
      activeByAddress: jest
        .fn()
        .mockResolvedValue(new Map([[sender.emailAddress, sender]])),
    } as unknown as MailSendersService,
    ingestion as unknown as MailIngestionService,
    gmail as unknown as GmailClientService,
  );
  return { service, connections, ingestion };
}

describe('MailSyncService.syncHistory', () => {
  it('procesa los correos nuevos y avanza el historyId', async () => {
    const ctx = setup({
      messagesAddedSince: jest
        .fn()
        .mockResolvedValue({ messageIds: ['a', 'b'], historyId: '150' }),
    });
    await ctx.service.syncHistory(connection);
    expect(ctx.ingestion.ingest).toHaveBeenCalledTimes(2);
    expect(ctx.connections.markSynced).toHaveBeenCalledWith('conn-1', '150');
  });

  it('si un correo no se pudo leer NO avanza el historyId', async () => {
    const ctx = setup(
      {
        messagesAddedSince: jest
          .fn()
          .mockResolvedValue({ messageIds: ['a', 'b'], historyId: '150' }),
      },
      jest
        .fn()
        .mockRejectedValueOnce(new Error('503'))
        .mockResolvedValueOnce(null),
    );
    await ctx.service.syncHistory(connection);
    // el resto del lote sí se intenta
    expect(ctx.ingestion.ingest).toHaveBeenCalledTimes(2);
    expect(ctx.connections.markSynced).not.toHaveBeenCalled();
    expect(ctx.connections.recordFailure).toHaveBeenCalled();
  });

  it('historial caducado (404): busca por fecha y reinicia el historyId', async () => {
    const searchMessages = jest.fn().mockResolvedValue(['c']);
    const ctx = setup({
      messagesAddedSince: jest.fn().mockRejectedValue({ status: 404 }),
      currentHistoryId: jest.fn().mockResolvedValue('999'),
      searchMessages,
    });
    await ctx.service.syncHistory(connection);
    expect(searchMessages.mock.calls[0][1]).toMatch(
      /^from:\(f@d1\.com\.co\) has:attachment after:\d+$/,
    );
    expect(ctx.ingestion.ingest).toHaveBeenCalledWith(
      connection,
      {},
      'c',
      expect.any(Map),
    );
    expect(ctx.connections.markSynced).toHaveBeenCalledWith('conn-1', '999');
  });
});
