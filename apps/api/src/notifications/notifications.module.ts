import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { MailQueueService } from './mail-queue.service';
import { MAIL_TRANSPORT, createMailTransport } from './mail-transport';

@Global()
@Module({
  providers: [{ provide: MAIL_TRANSPORT, useFactory: createMailTransport, inject: [AppConfig] }, MailQueueService],
  exports: [MailQueueService, MAIL_TRANSPORT],
})
export class NotificationsModule {}
