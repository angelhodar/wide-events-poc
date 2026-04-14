import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggingContextMiddleware } from './logging-context.middleware';
import { SyncUsersCron } from './sync-users.cron';
import { SyncUsersWorker } from './sync-users.worker';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AppController],
  providers: [AppService, SyncUsersCron, SyncUsersWorker],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggingContextMiddleware).forRoutes('*');
  }
}
