#!/usr/bin/env python3
"""Generate the proposed tenant-aware Prisma schema.

The active schema is never overwritten. The script writes a proposed schema and
a transformation report for review.

Usage:
  python3 scripts/saas/transform_schema.py \
    --schema apps/backend/prisma/schema.prisma \
    --out apps/backend/prisma/schema.tenant.prisma \
    --report docs/saas/schema-transform-report.md
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze_schema import (  # noqa: E402
    GLOBAL_REFERENCE_MODELS,
    LICENSE_MODELS,
    MODEL_RE,
    Model,
    classify_attr_unique,
    classify_field_unique,
    parse_models,
)

TENANT_ID_LINE = """tenantId String @default(dbgenerated("(NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid")) @map("tenant_id") @db.Uuid"""

PRIMARY_KEY_REWRITES = {
    "SystemSetting": ("key", ["tenantId", "key"]),
    "CourierAuthToken": ("courier", ["tenantId", "courier"]),
    "OrderCounter": (None, ["tenantId", "date", "family"]),
    "ReturnCounter": ("date", ["tenantId", "date"]),
    "PurchaseCounter": ("date", ["tenantId", "date"]),
}

NEW_MODELS = '''
model UsageCounter {
  id          String   @id @default(uuid())
  tenantId    String   @default(dbgenerated("(NULLIF(current_setting('app.tenant_id'::text, true), ''))::uuid")) @map("tenant_id") @db.Uuid
  metric      String
  periodStart DateTime
  value       BigInt   @default(0)
  updatedAt   DateTime @updatedAt

  @@unique([tenantId, metric, periodStart])
  @@index([tenantId, metric, periodStart])
}

model TenantEntitlementCache {
  tenantId   String   @id @map("tenant_id") @db.Uuid
  snapshot   Json
  validUntil DateTime?
  updatedAt  DateTime @updatedAt
}
'''.strip()


def field_line(indent: str, name: str, definition: str) -> str:
    return f"{indent}{name}{' ' * max(1, 10 - len(name))}{definition}"


def transform_model(model: Model, report: dict) -> str:
    if model.name in LICENSE_MODELS:
        report["removed_license_models"].append(model.name)
        return ""

    if model.name in GLOBAL_REFERENCE_MODELS:
        report["global_reference_models"].append(model.name)
        return f"model {model.name} {{\n{model.body}\n}}"

    field_unique_actions = {
        field: classify_field_unique(model, field) for field in model.unique_fields
    }
    attr_unique_actions = {
        ", ".join(fields): classify_attr_unique(model, fields)
        for fields in model.unique_attrs
    }

    pending_attr_lines: list[str] = []
    transformed_fields: list[str] = []
    has_tenant_index = False
    has_tenant_id = False
    pk_field, pk_fields = PRIMARY_KEY_REWRITES.get(model.name, (None, None))

    for line in model.body.splitlines():
        stripped = line.strip()
        indent_match = re.match(r"^(\s*)", line)
        indent = indent_match.group(1) if indent_match else "  "

        if not stripped:
            transformed_fields.append(line)
            continue

        if stripped.startswith("@@id("):
            if pk_fields:
                transformed_fields.append(f"{indent}@@id([{', '.join(pk_fields)}])")
                report["primary_key_rewrites"].append(
                    f"{model.name}: @@id -> @@id([{', '.join(pk_fields)}])"
                )
            else:
                transformed_fields.append(line)
            continue

        if stripped.startswith("@@"):
            unique_match = re.match(
                r"^@@unique\(\[([^\]]+)\](.*)$", stripped
            )
            if unique_match:
                fields = [part.strip() for part in unique_match.group(1).split(",")]
                action = attr_unique_actions.get(", ".join(fields), "KEEP")
                if action == "TENANT_COMPOSITE" and not any(
                    f == "tenantId" for f in fields
                ):
                    transformed_fields.append(
                        f"{indent}@@unique([tenantId, {', '.join(fields)}]{unique_match.group(2)}"
                    )
                    report["tenant_composite_attrs"].append(
                        f"{model.name}: [{', '.join(fields)}] -> [tenantId, {', '.join(fields)}]"
                    )
                else:
                    transformed_fields.append(line)
                continue

            index_match = re.match(r"^@@index\(\[([^\]]+)\](.*)$", stripped)
            if index_match:
                fields_raw = index_match.group(1)
                rest = index_match.group(2)
                if "ops:" in fields_raw or "type:" in fields_raw:
                    transformed_fields.append(line)
                    report["specialized_indexes_kept"].append(
                        f"{model.name}: @@index([{fields_raw}])"
                    )
                elif fields_raw.strip().startswith("tenantId"):
                    transformed_fields.append(line)
                    has_tenant_index = True
                else:
                    transformed_fields.append(
                        f"{indent}@@index([tenantId, {fields_raw}]{rest}"
                    )
                    report["prefixed_indexes"].append(
                        f"{model.name}: @@index([{fields_raw}]) -> [tenantId, {fields_raw}]"
                    )
                continue

            if stripped.startswith("@@map("):
                transformed_fields.append(line)
                continue

            transformed_fields.append(line)
            continue

        field_match = re.match(r"^(\w+)\s+(.+)$", stripped)
        if not field_match:
            transformed_fields.append(line)
            continue

        field_name, field_def = field_match.group(1), field_match.group(2)

        if field_name == "tenantId":
            has_tenant_id = True
            transformed_fields.append(f"{indent}{TENANT_ID_LINE}")
            report["tenant_id_updates"].append(model.name)
            continue

        if pk_field and field_name == pk_field:
            field_def = re.sub(r"\s+@id\b", "", field_def)
            transformed_fields.append(field_line(indent, field_name, field_def))
            report["primary_key_rewrites"].append(
                f"{model.name}: field @id removed from `{field_name}`"
            )
            continue

        action = field_unique_actions.get(field_name)
        if action == "TENANT_COMPOSITE":
            field_def = re.sub(r"\s+@unique\b", "", field_def)
            transformed_fields.append(field_line(indent, field_name, field_def))
            pending_attr_lines.append(
                f"  @@unique([tenantId, {field_name}])"
            )
            report["tenant_composite_fields"].append(
                f"{model.name}.{field_name} -> @@unique([tenantId, {field_name}])"
            )
        else:
            transformed_fields.append(field_line(indent, field_name, field_def))

    if not has_tenant_id:
        transformed_fields.insert(0, f"  {TENANT_ID_LINE}")
        report["tenant_id_added"].append(model.name)

    if pk_field and pk_fields:
        pending_attr_lines.append(f"  @@id([{', '.join(pk_fields)}])")

    # Drop duplicate pending @@id/@unique lines that already exist.
    existing = "\n".join(transformed_fields)
    for attr in pending_attr_lines:
        if attr.strip() not in existing:
            transformed_fields.append(attr)

    if not has_tenant_index and not any(
        re.match(r"^\s*@@index\(\[tenantId", line) for line in transformed_fields
    ):
        if not any(
            re.match(r"^\s*@@id\(\[tenantId", line) for line in transformed_fields
        ):
            transformed_fields.append("  @@index([tenantId])")
            report["standalone_tenant_indexes"].append(model.name)

    return f"model {model.name} {{\n" + "\n".join(transformed_fields) + "\n}"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--schema", default="apps/backend/prisma/schema.prisma", type=Path
    )
    parser.add_argument(
        "--out", default="apps/backend/prisma/schema.tenant.prisma", type=Path
    )
    parser.add_argument(
        "--report", default="docs/saas/schema-transform-report.md", type=Path
    )
    args = parser.parse_args()

    schema = args.schema.read_text()
    models = parse_models(schema)
    report: dict[str, list[str]] = {
        "tenant_id_added": [],
        "tenant_id_updates": [],
        "tenant_composite_fields": [],
        "tenant_composite_attrs": [],
        "prefixed_indexes": [],
        "standalone_tenant_indexes": [],
        "specialized_indexes_kept": [],
        "primary_key_rewrites": [],
        "removed_license_models": [],
        "global_reference_models": [],
    }

    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        body = match.group(2)
        model = next((m for m in models if m.name == name), None)
        if model is None:
            return match.group(0)
        return transform_model(model, report)

    transformed = MODEL_RE.sub(replace, schema)
    transformed = transformed.rstrip() + "\n\n" + NEW_MODELS + "\n"

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(transformed)

    lines = ["# Tenant schema transformation report\n"]
    lines.append(f"Source: `{args.schema}`")
    lines.append(f"Proposed schema: `{args.out}`\n")
    lines.append("## Summary\n")
    lines.append(f"- tenantId added: **{len(report['tenant_id_added'])}**")
    lines.append(f"- existing tenantId normalized: **{len(report['tenant_id_updates'])}**")
    lines.append(f"- field-level uniques converted: **{len(report['tenant_composite_fields'])}**")
    lines.append(f"- composite uniques prefixed: **{len(report['tenant_composite_attrs'])}**")
    lines.append(f"- indexes prefixed: **{len(report['prefixed_indexes'])}**")
    lines.append(f"- standalone tenant indexes: **{len(report['standalone_tenant_indexes'])}**")
    lines.append(f"- specialized indexes kept: **{len(report['specialized_indexes_kept'])}**")
    lines.append(f"- primary keys rewritten: **{len(report['primary_key_rewrites'])}**")
    lines.append(f"- license models removed: **{len(report['removed_license_models'])}**")
    lines.append(f"- global reference models: **{len(report['global_reference_models'])}**")
    lines.append("")

    for title, key in [
        ("Primary key rewrites", "primary_key_rewrites"),
        ("Field-level uniques converted", "tenant_composite_fields"),
        ("Composite uniques prefixed", "tenant_composite_attrs"),
        ("Specialized indexes kept", "specialized_indexes_kept"),
        ("Global reference models", "global_reference_models"),
        ("Removed license models", "removed_license_models"),
    ]:
        lines.append(f"## {title}\n")
        if not report[key]:
            lines.append("None.")
        for item in report[key]:
            lines.append(f"- {item}")
        lines.append("")

    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text("\n".join(lines) + "\n")
    print(json.dumps({
        "output": str(args.out),
        "report": str(args.report),
        "tenant_id_added": len(report["tenant_id_added"]),
        "tenant_id_updates": len(report["tenant_id_updates"]),
        "field_uniques": len(report["tenant_composite_fields"]),
        "composite_uniques": len(report["tenant_composite_attrs"]),
        "indexes_prefixed": len(report["prefixed_indexes"]),
        "standalone_indexes": len(report["standalone_tenant_indexes"]),
        "specialized_indexes": len(report["specialized_indexes_kept"]),
        "primary_keys": len(report["primary_key_rewrites"]),
        "license_models_removed": len(report["removed_license_models"]),
        "global_reference_models": len(report["global_reference_models"]),
    }, indent=2))


if __name__ == "__main__":
    main()
