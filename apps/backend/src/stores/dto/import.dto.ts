/**
 * Product-import DTOs — WooCommerce product import (§7.1, §13, §15).
 *
 * The import wizard's wire contract. `StartImportDto` is the confirm step:
 * the operator's reviewed decisions plus the per-import options (publish
 * mode, category mode, stock tick, skip-images, idempotency key).
 */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Max decisions per confirm (§13.1: 100-page batch cap, 100 per page). */
export const IMPORT_MAX_DECISIONS = 10000;

/** Products per import page job (§10.3). */
export const IMPORT_PAGE_SIZE = 100;

export const IMPORT_DECISION_ACTIONS = ['create', 'link', 'skip'] as const;
export type ImportDecisionAction = (typeof IMPORT_DECISION_ACTIONS)[number];

export const IMPORT_PUBLISH_MODES = ['draft', 'active'] as const;
export type ImportPublishMode = (typeof IMPORT_PUBLISH_MODES)[number];

/**
 * R3 three-way category mode. The strings are the agreed frontend contract
 * (phase-2 alignment): 'with_categories' = match-or-create per remote
 * category, 'assign_one' = assign all to one existing category, 'none' =
 * uncategorized.
 */
export const IMPORT_CATEGORY_MODES = ['with_categories', 'assign_one', 'none'] as const;
export type ImportCategoryMode = (typeof IMPORT_CATEGORY_MODES)[number];

export class ImportDecisionDto {
  /** Remote product id (Woo numeric id as a string). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  remoteId!: string;

  @IsIn([...IMPORT_DECISION_ACTIONS])
  action!: ImportDecisionAction;

  /** Link target — required when action=link. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  productId?: string;

  /** Skip note — shown on the review screen when the product reappears. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /**
   * Remote status as shown on the catalog row the operator reviewed
   * ('publish' | 'draft' | ...). Used ONLY for the quota pre-check estimate
   * (how many creates will land active); the per-create check is the
   * authoritative gate, so a stale value here can only over- or
   * under-estimate the pre-check, never bypass the quota.
   */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  remoteStatus?: string;
}

export class StartImportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(IMPORT_MAX_DECISIONS)
  @ValidateNested({ each: true })
  @Type(() => ImportDecisionDto)
  decisions!: ImportDecisionDto[];

  /** D1: drafts default. 'active' publishes publish-status remotes. */
  @IsIn([...IMPORT_PUBLISH_MODES])
  publishMode!: ImportPublishMode;

  /** R3: how remote categories map onto local categories. */
  @IsIn([...IMPORT_CATEGORY_MODES])
  categoryMode!: ImportCategoryMode;

  /** Assign-one target — required when categoryMode=assign_one. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  categoryId?: string;

  /**
   * R4 stock tick (default ON): bring remote stock levels into the
   * MANAGED-STOCK layer as a one-time seed. OFF seeds nothing. Named
   * `stockTick` per the agreed frontend contract.
   */
  @IsOptional()
  @IsBoolean()
  stockTick?: boolean;

  /** Skip background image downloads for this import. */
  @IsOptional()
  @IsBoolean()
  skipImages?: boolean;

  /**
   * Client-generated idempotency key (a UUID per confirm click). A second
   * confirm with the same key returns the original batch run id instead of
   * starting a duplicate import. Required by the frontend contract (the
   * wizard always sends one).
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  idempotencyKey!: string;
}

export class ImportCatalogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  /** Free-text search (name/SKU, provider-side when supported). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  /** Remote status filter (provider vocabulary, e.g. 'publish'). */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  /**
   * Match filter: 'all' | 'unmatched' | 'matched' | 'linked' | 'skipped' |
   * 'new' (new since last import). 'all' = all EXCEPT skipped (design
   * §2.3 default). Applied in-memory on the fetched provider page (see
   * StoreProductImportService.fetchCatalog).
   */
  @IsOptional()
  @IsIn(['all', 'unmatched', 'matched', 'linked', 'skipped', 'new'])
  match?: string;

  /** Remote category slug filter (applied in-memory on the fetched page). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  category?: string;

  /** Remote stock-status filter (instock | outofstock | onbackorder). */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  stock?: string;

  /** Incremental: only products modified after this ISO instant. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  modifiedAfter?: string;
}

export class CreateImportSkipDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  remoteId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
