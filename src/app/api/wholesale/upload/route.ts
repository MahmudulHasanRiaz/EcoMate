import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import { join } from "path";
import { mkdir } from "fs/promises";
import { requireWholesalerSession } from "@/server/modules/wholesale-portal-auth";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  try {
    // 1. Verify wholesaler session
    const session = await requireWholesalerSession();
    if (!session?.customerId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse form data
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // BLOCKER 11: Security Hardening
    // Max 5MB
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 });
    }

    // Allowlist: images only
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Only JPG, PNG, WEBP allowed." }, { status: 400 });
    }

    // 3. Prepare upload directory
    const uploadDir = join(process.cwd(), "public", "uploads", "requests");
    try {
      await mkdir(uploadDir, { recursive: true });
    } catch (e) {
      // Ignore if directory already exists
    }

    // 4. Save file with safe extension
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    // Verify magic bytes (content signature)
    const hex = buffer.toString('hex', 0, 4);
    let isValidSignature = false;
    if (file.type === "image/jpeg" && hex.startsWith("ffd8")) isValidSignature = true;
    if (file.type === "image/png" && hex.startsWith("89504e47")) isValidSignature = true;
    if (file.type === "image/webp") {
      const isRiff = hex === "52494646"; // "RIFF"
      const isWebp = buffer.length > 12 && buffer.toString('hex', 8, 12) === "57454250"; // "WEBP"
      if (isRiff && isWebp) isValidSignature = true;
    }

    if (!isValidSignature) {
      return NextResponse.json({ error: "Invalid file content signature. File may be corrupted or spoofed." }, { status: 400 });
    }

    let extension = "jpg";
    if (file.type === "image/png") extension = "png";
    if (file.type === "image/webp") extension = "webp";
    
    const filename = `${randomUUID()}.${extension}`;
    const filePath = join(uploadDir, filename);

    await writeFile(filePath, buffer);

    // 5. Return URL
    const url = `/uploads/requests/${filename}`;
    return NextResponse.json({ url });

  } catch (error: any) {
    console.error("Wholesale image upload error:", error);
    
    const isAuthError = error.message?.toLowerCase().includes("unauthorized") || 
                        error.message?.toLowerCase().includes("session") ||
                        error.message?.toLowerCase().includes("token");
                        
    if (isAuthError) {
      return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
    }

    return NextResponse.json(
      { error: "Failed to upload image due to an internal error" },
      { status: 500 }
    );
  }
}
