import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({ origin: true });
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('InfraGraph API')
    .setDescription('Infrastructure Change Intelligence')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT || 8000;
  await app.listen(port, '0.0.0.0');
  console.log(`InfraGraph API listening on :${port}`);
}
bootstrap();
