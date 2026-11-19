import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Lead internal notes (Batch 2, item 12). Operator-only working notes
 * (never shown to the lead). null / blank clears the notes.
 */
export class UpdateLeadNotesDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  internalNotes?: string | null;
}
