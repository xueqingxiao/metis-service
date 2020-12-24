import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const __PROD__ = process.env.NODE_ENV === 'production';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('/api');
  app.enableCors();
  await app.listen(__PROD__ ? 80 : 3030);
}
bootstrap();
