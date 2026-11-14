import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
  );

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // The platform admin and landing origins are added with those apps.
  // Platform endpoints are same-origin or server-to-server until then.

  const port = Number(process.env.PLATFORM_PORT ?? 4100);
  await app.listen(port, '0.0.0.0');
  console.log(`Platform API listening on http://0.0.0.0:${port}/api`);
}

void bootstrap();
