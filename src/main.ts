import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { initLogger } from 'evlog';
import { AppModule } from './app.module';
import { EvlogExceptionFilter } from './evlog-exception.filter';

initLogger({
  env: { service: process.env.EVLOG_SERVICE ?? 'nestjs-evlog' }, pretty: true,
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new EvlogExceptionFilter());
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
