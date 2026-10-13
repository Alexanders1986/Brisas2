import { Module } from '@nestjs/common';
import { OverviewController } from './overview.controller';
import { StructureController } from './structure.controller';
import { StructureService } from './structure.service';

@Module({ controllers: [OverviewController, StructureController], providers: [StructureService] })
export class TenancyModule {}
