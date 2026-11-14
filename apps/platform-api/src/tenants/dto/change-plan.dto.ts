import { IsUUID } from 'class-validator';

export class ChangePlanDto {
  @IsUUID()
  planVersionId!: string;
}
