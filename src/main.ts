import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3010);
  await app.listen(port);
  console.log(`ascendra-commons-sandbox listening on http://localhost:${port}`);
}

void bootstrap();
