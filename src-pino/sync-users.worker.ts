import { Injectable } from '@nestjs/common';
import { useLogger } from './logger';

@Injectable()
export class SyncUsersWorker {
  async run() {
    const log = useLogger();
    log.set({ sync: { phase: 'run-start' } });

    await this.fetchUsers();
    await this.persistUsers();

    log.set({ sync: { phase: 'run-finished' } });
  }

  private async fetchUsers() {
    const log = useLogger();
    log.set({ sync: { phase: 'fetch-users' } });

    await this.delay(25);
    await this.fetchFromRemoteApi();
  }

  private async fetchFromRemoteApi() {
    const log = useLogger();
    log.set({ sync: { source: 'remote-api', fetched: 3 } });

    await this.delay(25);
  }

  private async persistUsers() {
    const log = useLogger();
    log.set({ sync: { phase: 'persist-users' } });

    await this.delay(25);
  }

  private async delay(ms: number) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
