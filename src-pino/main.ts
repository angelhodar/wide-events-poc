import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppExceptionFilter } from './app-exception.filter';
import { NestLogger } from './logger';
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: new NestLogger() });
  app.useGlobalFilters(new AppExceptionFilter());
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
