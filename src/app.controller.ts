import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { AppService } from './app.service';

export class CreateSessionParams {
  username: string;
}

@Controller('/session')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/wx-sign')
  getWeChatSign(@Query() query: { url: string }) {
    return this.appService.getWeChatConfig(query.url);
  }

  @Post()
  createSession(@Body() params: CreateSessionParams) {
    return this.appService.createSession(params.username);
  }

  @Get('/:uid')
  getSession(@Param('uid') uid: string) {
    return this.appService.getSession(parseInt(uid));
  }

  @Put('/:sessionId')
  joinSession(
    @Param('sessionId') sessionId: string,
    @Body() params: CreateSessionParams,
  ) {
    return this.appService.joinSession(sessionId, params.username);
  }
}
