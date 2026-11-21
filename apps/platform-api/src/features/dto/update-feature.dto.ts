import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * PATCH /features/:key. Kind uses Boss's words ('initial' / 'add-on');
 * the service maps them to the Prisma FeatureKind enum (which cannot
 * contain hyphens). Scope text is EN only (Boss decision 7).
 *
 * NOTE: changing kind here is classification only — it does not move
 * tenants or money. The billing conversion (dry-run + grandfathering)
 * is POST /features/:key/convert-to-addon.
 */
export class UpdateFeatureDto {
  @IsOptional()
  @IsIn(['initial', 'add-on'])
  kind?: 'initial' | 'add-on';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scope?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  withoutAccess?: string;
}
