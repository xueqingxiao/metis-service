import { Injectable, Logger } from '@nestjs/common';
import { RtcTokenBuilder, RtcRole } from 'agora-access-token';
import { RedisService } from 'nestjs-redis';
import md5 = require('js-md5');
import axios from 'axios';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';

export enum NetlessRole {
  ADMIN = 'admin',
  WRITER = 'writer',
  READER = 'reader',
}

export interface NetlessSession {
  uuid: string;
  token: string;
  appIdentifier: string;
  role: string;
  sdkToken: string;
}

export interface AgoraSession {
  appId: string;
  channel: string;
  token: string;
  uid: number;
}

export interface SessionDTO {
  id: string;
  uid: number;
  username: string;
  expiredAt: number;
  agora: AgoraSession;
  netless: NetlessSession;
}

export const ETA = 60 * 60;

@Injectable()
export class AppService {
  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async createSession(username: string): Promise<number> {
    const client = await this.redisService.getClient();
    const uid = this.buildUid();
    const id = this.buildSessionId();
    const expiredAt = Date.now() / 1000 + ETA;
    const agoraToken = this.buildAgoraToken(id, uid, expiredAt);
    const netlessRoomUUID = await this.retrieveNetlessRoomUUID();
    const netlessRoomToken = await this.retrieveNetlessRoomToken(
      netlessRoomUUID,
      ETA * 1000,
      NetlessRole.ADMIN,
    );

    // session:${sessionId}:expiredAt
    await client.set(`s:${id}:ea`, expiredAt);
    // user:${sessionId}:netlessRoomUUID
    await client.set(`s:${id}:nru`, netlessRoomUUID);

    // user:${userToken}:uid
    await client.set(`u:${uid}:uid`, uid);
    // user:${userToken}:sessionId
    await client.set(`u:${uid}:sid`, id);
    // user:${userToken}:username
    await client.set(`u:${uid}:um`, username);
    // user:${userToken}:agoraToken;
    await client.set(`u:${uid}:at`, agoraToken);
    // user:${userToken}:netlessRoomToken
    await client.set(`u:${uid}:nrt`, netlessRoomToken);
    // user:${userToken}:netlessRole
    await client.set(`u:${uid}:nr`, NetlessRole.ADMIN);

    return uid;
  }

  async getSession(uid: number): Promise<SessionDTO> {
    const client = await this.redisService.getClient();
    const t = await client.get(`u:${uid}:uid`);
    if (!t) {
      throw new Error("You don't have joined or created any session.");
    }

    const id = await client.get(`u:${uid}:sid`);
    const expiredAt = await client.get(`s:${id}:ea`);
    const netlessRoomUUID = await client.get(`s:${id}:nru`);

    const username = await client.get(`u:${uid}:um`);
    const agoraToken = await client.get(`u:${uid}:at`);
    const netlessRoomToken = await client.get(`u:${uid}:nrt`);
    const netlessTole = await client.get(`u:${uid}:nr`);

    return {
      id,
      uid,
      username,
      expiredAt: Number(expiredAt),
      agora: this.buildAgoraSession(id, uid, agoraToken),
      netless: this.buildNetlessSession(
        netlessRoomUUID,
        netlessRoomToken,
        netlessTole,
      ),
    };
  }

  async joinSession(id: string, username: string) {
    const client = await this.redisService.getClient();
    const uid = this.buildUid();
    const expiredAt = Number(await client.get(`s:${id}:ea`));
    const agoraToken = this.buildAgoraToken(id, uid, expiredAt);
    const netlessRoomUUID = await client.get(`s:${id}:nru`);
    const netlessRoomToken = await this.retrieveNetlessRoomToken(
      netlessRoomUUID,
      ETA * 1000,
      NetlessRole.WRITER,
    );

    // user:${userToken}:token
    await client.set(`u:${uid}:uid`, uid);
    // user:${userToken}:sessionId
    await client.set(`u:${uid}:sid`, id);
    // user:${userToken}:username
    await client.set(`u:${uid}:um`, username);
    // user:${userToken}:agoraToken;
    await client.set(`u:${uid}:at`, agoraToken);
    // user:${userToken}:netlessRoomToken
    await client.set(`u:${uid}:nrt`, netlessRoomToken);
    // user:${userToken}:netlessRole
    await client.set(`u:${uid}:nr`, NetlessRole.WRITER);

    return uid;
  }

  async getWeChatConfig(url: string) {
    const accessToken = await this.retrieveWeChatAccessToken();
    const ticket = await this.retrieveWeChatTicket(accessToken);
    const timestamp = this.buildTimestamp();
    const nonceStr = this.buildNonce();
    const original = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
    const signature = createHash('sha1')
      .update(original)
      .digest('hex');
    return {
      appId: this.configService.get('WE_CHAT_APP_ID'),
      timestamp,
      nonceStr,
      signature,
    };
  }

  private buildNetlessSession(
    uuid: string,
    token: string,
    role: string,
  ): NetlessSession {
    return {
      uuid,
      token,
      appIdentifier: this.configService.get('NETLESS_APP_IDENTIFIER'),
      role,
      sdkToken: this.configService.get('NETLESS_SDK_TOKEN'),
    };
  }

  private buildAgoraSession(
    id: string,
    uid: number,
    agoraToken: string,
  ): AgoraSession {
    return {
      appId: this.configService.get('AGORA_APP_ID'),
      channel: id,
      uid,
      token: agoraToken,
    };
  }

  private async retrieveNetlessRoomUUID() {
    try {
      const {
        data: { uuid },
      } = await axios.post<{ uuid: string }>(
        'https://shunt-api.netless.link/v5/rooms',
        null,
        { headers: { token: this.configService.get('NETLESS_SDK_TOKEN') } },
      );
      Logger.debug('netless room uuid: ', uuid);
      return uuid;
    } catch (error) {
      Logger.error('Failed to retrieve netless room uuid: ', error);
    }
  }

  private async retrieveNetlessRoomToken(
    roomUUID: string,
    lifespan: number,
    role: string,
  ): Promise<string> {
    try {
      const { data: roomToken } = await axios.post<string>(
        `https://shunt-api.netless.link/v5/tokens/rooms/${roomUUID}`,
        {
          lifespan,
          role,
        },
        {
          headers: { token: this.configService.get('NETLESS_SDK_TOKEN') },
        },
      );
      Logger.debug('netless room token: ', roomToken);
      return roomToken;
    } catch (error) {
      Logger.error('Failed to retrieve netless room token: ', error);
    }
  }

  private async retrieveNetlessTaskUUID() {
    return axios.post(
      'https://shunt-api.netless.link/v5/services/conversion/tasks',
    );
  }

  private async retrieveNetlessTaskToken(
    taskUUID: string,
    lifespan: number,
    role: NetlessRole,
  ) {
    try {
      const { data: taskToken } = await axios.post<string>(
        `https://shunt-api.netless.link/v5/tokens/tasks/${taskUUID}`,
        {
          lifespan,
          role,
        },
        {
          headers: { token: this.configService.get('NETLESS_SDK_TOKEN') },
        },
      );
    } catch (error) {}
  }

  private async retrieveWeChatAccessToken(): Promise<string> {
    const {
      data: { access_token: accessToken },
    } = await axios.get<{ access_token: string }>(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appId=${this.configService.get(
        'WE_CHAT_APP_ID',
      )}&secret=${this.configService.get('WE_CHAT_APP_SECRET')}`,
    );
    if (!accessToken) {
      Logger.error('can not retrieve WeChat access token.');
    }
    return accessToken;
  }

  private async retrieveWeChatTicket(token: string): Promise<string> {
    const {
      data: { ticket },
    } = await axios.get<{ ticket: string }>(
      `https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${token}&type=jsapi`,
    );
    if (!ticket) {
      Logger.error('can not retrieve WeChat ticket.');
    }
    return ticket;
  }

  private buildAgoraToken(channel: string, uid: number, expiredAt: number) {
    return RtcTokenBuilder.buildTokenWithUid(
      this.configService.get('AGORA_APP_ID'),
      this.configService.get('AGORA_APP_CERTIFICATE'),
      channel,
      uid,
      RtcRole.PUBLISHER,
      expiredAt,
    );
  }

  private buildSessionId() {
    return md5.hex(
      `${Math.random()
        .toString(36)
        .substr(2)}`,
    );
  }

  private buildUid(): number {
    return Math.floor(100000000 + Math.random() * 900000000);
  }

  private buildNonce(): string {
    return Math.random()
      .toString(36)
      .substr(2, 15);
  }

  private buildTimestamp(): number {
    return parseInt(`${new Date().getTime() / 1000}`);
  }
}
