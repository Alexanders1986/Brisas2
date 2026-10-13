import { Module } from '@nestjs/common';
import { PqrController } from './pqr.controller';
import { PqrService } from './pqr.service';

@Module({ controllers: [PqrController], providers: [PqrService] })
export class PqrModule {}
