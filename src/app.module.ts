import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from 'nestjs-redis';
import { AppController } from './app.controller';
import { AppService } from './app.service';

const __PROD__ = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: __PROD__ ? undefined : ['.env.development.local'],
      ignoreEnvFile: __PROD__,
      isGlobal: true,
    }),
    RedisModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        host: configService.get('REDIS_HOST'),
        port: parseInt(configService.get('REDIS_PORT')),
        password: configService.get('REDIS_PASSWORD'),
        tls: {}
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
