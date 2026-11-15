#!/usr/bin/env python3
"""Analyze the tenant schema before the multi-tenant transformation.

The script never edits the Prisma schema. It classifies every primary key,
single-field unique and @@unique block so the transformation can be reviewed
before tenantId/composite keys are applied.

Usage:
  python3 scripts/saas/analyze_schema.py \
    --schema apps/backend/prisma/schema.prisma \
    --out docs/saas/schema-analysis.md
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

MODEL_RE = re.compile(r"^model\s+(\w+)\s*\{\n(.*?)\n\}", re.MULTILINE | re.DOTALL)
MAP_RE = re.compile(r'@@map\("([^"]+)"\)')
ID_ATTR_RE = re.compile(r"@@id\(\[([^\]]+)\]")
UNIQUE_ATTR_RE = re.compile(r"@@unique\(\[([^\]]+)\]")
INDEX_ATTR_RE = re.compile(r"@@index\(\[([^\]]+)\]")
FIELD_RE = re.compile(r"^\s*(\w+)\s+(.+?)\s*$")
RELATION_FIELDS_RE = re.compile(r"@relation\([^)]*fields:\s*\[([^\]]+)\]")

LICENSE_MODELS = {"LicenseActivation", "LicenseActivationHistory"}

# Reference data shared by every tenant. These tables are intentionally
# RLS-exempt and do not get tenantId; their rows are seeded by the platform.
GLOBAL_REFERENCE_MODELS = {"SourcePlatform", "MarketingPlatform", "PaymentOption"}

# Opaque tokens are looked up without a tenant scope and are cryptographically
# random. Keep them globally unique; RLS still scopes the row.
GLOBAL_TOKEN_FIELDS = {
    "token",
    "viewToken",
    "secureToken",
    "sessionToken",
}

GLOBAL_UUID_FIELDS = {
    "sourceConsumptionId",
    "journalEntryId",
    "reversalJournalEntryId",
    "reversalOfId",
    "ctxId",
    "snapshotId",
    "eventId",
    "betterAuthUserId",
}

TENANT_COMPOSITE_FIELDS = {
    "employeeId",
    "startDate",
    "endDate",
    "email",
    "username",
    "phone",
    "slug",
    "name",
    "code",
    "key",
    "displayId",
    "idempotencyKey",
    "dedupKey",
    "referenceNo",
    "externalId",
    "identifier",
    "accountId",
    "providerName",
    "type",
    "courier",
    "date",
    "periodKey",
    "purpose",
    "family",
    "eventType",
    "severity",
    "category",
    "bucket",
    "blockSource",
    "targetType",
    "sourceType",
    "channel",
    "transactionId",
    "gatewayCode",
    "providerPaymentId",
    "providerAccountId",
    "providerCampaignId",
    "providerAdSetId",
    "providerAdId",
    "providerBusinessId",
    "clientKey",
    "grnNumber",
    "lotNumber",
    "entryNo",
    "invoiceNo",
    "sku",
    "ip",
    "templateKey",
}

TENANT_DIMENSION_FIELDS = {"tenant", "tenantId"}


@dataclass
class Model:
    name: str
    body: str
    lines: list[str] = field(default_factory=list)
    table: str = ""
    fields: dict[str, str] = field(default_factory=dict)
    fk_fields: set[str] = field(default_factory=set)
    id_fields: list[str] = field(default_factory=list)
    unique_fields: list[str] = field(default_factory=list)
    unique_attrs: list[list[str]] = field(default_factory=list)
    index_attrs: list[list[str]] = field(default_factory=list)
    id_attrs: list[list[str]] = field(default_factory=list)
    tenant_fields: list[str] = field(default_factory=list)
    raw_attr_lines: list[str] = field(default_factory=list)


def split_fields(body: str) -> list[str]:
    return [
        line.strip()
        for line in body.splitlines()
        if line.strip()
        and not line.strip().startswith("//")
        and not line.strip().startswith("///")
    ]


def parse_models(schema: str) -> list[Model]:
    models: list[Model] = []
    for match in MODEL_RE.finditer(schema):
        name, body = match.group(1), match.group(2)
        model = Model(name=name, body=body, lines=split_fields(body))
        mapped = MAP_RE.search(body)
        model.table = mapped.group(1) if mapped else name
        for line in model.lines:
            if line.startswith("@@"):
                model.raw_attr_lines.append(line)
                id_match = ID_ATTR_RE.search(line)
                unique_match = UNIQUE_ATTR_RE.search(line)
                index_match = INDEX_ATTR_RE.search(line)
                if id_match:
                    model.id_attrs.append(
                        [part.strip() for part in id_match.group(1).split(",")]
                    )
                if unique_match:
                    model.unique_attrs.append(
                        [part.strip() for part in unique_match.group(1).split(",")]
                    )
                if index_match:
                    model.index_attrs.append(
                        [part.strip() for part in index_match.group(1).split(",")]
                    )
                continue
            field_match = FIELD_RE.match(line)
            if not field_match:
                continue
            field_name, field_def = field_match.group(1), field_match.group(2)
            model.fields[field_name] = field_def
            if "@id" in field_def:
                model.id_fields.append(field_name)
            if "@unique" in field_def:
                model.unique_fields.append(field_name)
            if field_name in TENANT_DIMENSION_FIELDS:
                model.tenant_fields.append(field_name)
            relation = RELATION_FIELDS_RE.search(field_def)
            if relation:
                for fk in relation.group(1).split(","):
                    fk = fk.strip()
                    if fk:
                        model.fk_fields.add(fk)
        models.append(model)
    return models


def is_uuid_like(model: Model, name: str) -> bool:
    return (
        name in model.fk_fields
        or name in GLOBAL_UUID_FIELDS
        or name in GLOBAL_TOKEN_FIELDS
    )


def classify_field_unique(model: Model, field: str) -> str:
    if field in GLOBAL_TOKEN_FIELDS:
        return "KEEP_GLOBAL_TOKEN"
    if field in model.fk_fields or field in GLOBAL_UUID_FIELDS:
        return "KEEP_GLOBAL_UUID_FK"
    if field in TENANT_COMPOSITE_FIELDS:
        return "TENANT_COMPOSITE"
    return "MANUAL_REVIEW"


def classify_attr_unique(model: Model, fields: list[str]) -> str:
    if any(f in TENANT_DIMENSION_FIELDS for f in fields):
        return "ALREADY_TENANT_SCOPED"
    # If any column is a UUID foreign key, the combination is globally unique
    # because the referenced row is globally unique. Keep the existing key
    # shape so findUnique/upsert calls do not change.
    if any(f in model.fk_fields or f in GLOBAL_UUID_FIELDS for f in fields):
        return "KEEP_GLOBAL_UUID_PAIR"
    if any(f in TENANT_COMPOSITE_FIELDS for f in fields):
        return "TENANT_COMPOSITE"
    return "MANUAL_REVIEW"


def classify_primary_key(model: Model) -> list[str]:
    findings: list[str] = []
    if model.name in GLOBAL_REFERENCE_MODELS:
        return [f"GLOBAL_REFERENCE — RLS-exempt reference table (no tenantId)"]
    for field in model.id_fields:
        if field == "id":
            continue
        findings.append(
            f"single-field @id `{field}` — needs tenant-composite key review"
        )
    for fields in model.id_attrs:
        if any(f in TENANT_DIMENSION_FIELDS for f in fields):
            findings.append(
                f"@@id already tenant-scoped: [{', '.join(fields)}]"
            )
        elif any(f in model.fk_fields or f in GLOBAL_UUID_FIELDS for f in fields):
            continue
        else:
            findings.append(
                f"@@id has no UUID foreign key: [{', '.join(fields)}] — needs tenant-composite key review"
            )
    return findings


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--schema", default="apps/backend/prisma/schema.prisma", type=Path
    )
    parser.add_argument(
        "--out", default="docs/saas/schema-analysis.md", type=Path
    )
    args = parser.parse_args()

    schema = args.schema.read_text()
    models = parse_models(schema)

    counts = {
        "models": len(models),
        "tenantId_present": 0,
        "field_uniques": 0,
        "attr_uniques": 0,
        "specialized_indexes": 0,
        "mapped_tables": 0,
        "global_reference": 0,
    }
    field_rows: list[tuple[str, str, str]] = []
    attr_rows: list[tuple[str, str, str]] = []
    pk_rows: list[tuple[str, list[str]]] = []
    specialized_rows: list[tuple[str, str]] = []
    mapped_rows: list[tuple[str, str]] = []

    for model in models:
        if model.name in LICENSE_MODELS:
            continue

        if model.name in GLOBAL_REFERENCE_MODELS:
            counts["global_reference"] += 1
        if "tenantId" in model.tenant_fields:
            counts["tenantId_present"] += 1
        if model.table != model.name:
            counts["mapped_tables"] += 1
            mapped_rows.append((model.name, model.table))

        for field in model.unique_fields:
            counts["field_uniques"] += 1
            field_rows.append(
                (model.name, field, classify_field_unique(model, field))
            )

        for fields in model.unique_attrs:
            counts["attr_uniques"] += 1
            attr_rows.append(
                (model.name, ", ".join(fields), classify_attr_unique(model, fields))
            )

        for fields in model.index_attrs:
            if any("ops:" in f or "type:" in f for f in fields):
                counts["specialized_indexes"] += 1
                specialized_rows.append((model.name, ", ".join(fields)))

        pk_findings = classify_primary_key(model)
        if pk_findings:
            pk_rows.append((model.name, pk_findings))

    action_counts: dict[str, int] = {}
    for _, _, action in field_rows + attr_rows:
        action_counts[action] = action_counts.get(action, 0) + 1

    lines: list[str] = []
    lines.append("# Tenant schema analysis\n")
    lines.append(
        "Generated by `scripts/saas/analyze_schema.py`. The active Prisma schema is not modified.\n"
    )
    lines.append("## Summary\n")
    lines.append(f"- Models: **{counts['models']}**")
    lines.append(f"- Global reference models (RLS-exempt): **{counts['global_reference']}**")
    lines.append(f"- Models with `tenantId` already: **{counts['tenantId_present']}**")
    lines.append(f"- Single-field uniques: **{counts['field_uniques']}**")
    lines.append(f"- `@@unique` constraints: **{counts['attr_uniques']}**")
    lines.append(f"- Specialized indexes (skip index-prefix, add tenant index): **{counts['specialized_indexes']}**")
    lines.append(f"- Mapped tables: **{counts['mapped_tables']}**")
    lines.append("")
    lines.append("### Classification counts\n")
    for action, count in sorted(action_counts.items()):
        lines.append(f"- `{action}`: **{count}**")
    lines.append("")

    lines.append("## Primary keys needing review\n")
    if not pk_rows:
        lines.append("None.")
    for model, findings in pk_rows:
        lines.append(f"### `{model}`")
        for finding in findings:
            lines.append(f"- {finding}")
        lines.append("")

    lines.append("## Single-field uniques\n")
    lines.append("| Model | Field | Proposed action |")
    lines.append("|---|---|---|")
    for model, field, action in sorted(field_rows):
        lines.append(f"| `{model}` | `{field}` | `{action}` |")
    lines.append("")

    lines.append("## `@@unique` constraints\n")
    lines.append("| Model | Fields | Proposed action |")
    lines.append("|---|---|---|")
    for model, fields, action in sorted(attr_rows):
        lines.append(f"| `{model}` | `{fields}` | `{action}` |")
    lines.append("")

    lines.append("## Global reference models (no tenantId, RLS-exempt)\n")
    for model in sorted(GLOBAL_REFERENCE_MODELS):
        lines.append(f"- `{model}`")
    lines.append("")

    lines.append("## Specialized indexes\n")
    if not specialized_rows:
        lines.append("None.")
    for model, fields in specialized_rows:
        lines.append(f"- `{model}`: `@@index([{fields}])` — keep as-is; add `@@index([tenantId])`")
    lines.append("")

    lines.append("## Mapped tables\n")
    lines.append("| Model | Table |")
    lines.append("|---|---|")
    for model, table in mapped_rows:
        lines.append(f"| `{model}` | `{table}` |")
    lines.append("")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("\n".join(lines) + "\n")
    print(json.dumps({
        "models": counts["models"],
        "field_uniques": counts["field_uniques"],
        "attr_uniques": counts["attr_uniques"],
        "specialized_indexes": counts["specialized_indexes"],
        "mapped_tables": counts["mapped_tables"],
        "global_reference": counts["global_reference"],
        "classification": action_counts,
        "report": str(args.out),
    }, indent=2))


if __name__ == "__main__":
    main()
