import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EvlogModule } from 'evlog/nestjs';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SyncUsersCron } from './sync-users.cron';
import { SyncUsersWorker } from './sync-users.worker';

@Module({
  imports: [ScheduleModule.forRoot(), EvlogModule.forRoot()],
  controllers: [AppController],
  providers: [AppService, SyncUsersCron, SyncUsersWorker],
})
export class AppModule {}
