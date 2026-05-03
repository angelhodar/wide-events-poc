import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { UseLoggingContext, useLogger } from './logger';
import { SyncUsersWorker } from './sync-users.worker';

@Injectable()
export class SyncUsersCron {
  constructor(private readonly syncUsersWorker: SyncUsersWorker) {}

  @Cron('* * * * *')
  @UseLoggingContext({ source: 'cron', job: 'syncUsers' }, { rethrow: false })
  async handleSync() {
    const log = useLogger();

    log.set({
      sync: {
        startedAt: new Date().toISOString(),
      },
    });

    await this.syncUsersWorker.run();

    log.set({
      sync: {
        status: 'ok',
      },
    });
  }
}
