import { Module } from '@nestjs/common';
import { ResidentsController } from './residents.controller';
import { ResidentsService } from './residents.service';

@Module({ controllers: [ResidentsController], providers: [ResidentsService] })
export class ResidentsModule {}
