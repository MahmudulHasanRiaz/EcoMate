/**
 * Wholesaler Portal Authentication
 * Phone + OTP login with Redis-backed session
 */

import { prisma } from "@/lib/prisma";
import { getRedisClient } from "@/server/queues/redis";
import { sendSmsRaw } from "./sms-notifications";
import { randomInt, createHmac, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { normalizeBdPhoneForStorage } from "@/lib/phone";

const OTP_TTL_SECONDS = 300; // 5 minutes
const SESSION_TTL_SECONDS = 86400 * 7; // 7 days
const SESSION_COOKIE_NAME = "wholesaler_session";
const OTP_PREFIX = "wholesaler:otp:";
const SESSION_PREFIX = "wholesaler:session:";

function getRedis() {
  const redis = getRedisClient();
  if (!redis) throw new Error("Redis is not configured");
  return redis;
}

function generateOtp(): string {
  return String(randomInt(100000, 999999));
}

function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

async function hashToken(token: string): Promise<string> {
  const secret = process.env.WHOLESALER_SESSION_SECRET || process.env.NEXT_AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Server configuration error: WHOLESALER_SESSION_SECRET is not set.",
      );
    }
    // In dev, if no secret is set, we still want a consistent hash but it should be loud that it's insecure
    return createHmac("sha256", "dev-insecure-secret")
      .update(token)
      .digest("hex");
  }
  return createHmac("sha256", secret).update(token).digest("hex");
}

// ============================================================================
// OTP Flow
// ============================================================================

export async function sendWholesalerOtp(phone: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const normalized = normalizeBdPhoneForStorage(phone);
  if (!normalized.isValid) {
    return { success: false, error: "Invalid Bangladesh phone number" };
  }
  const dbPhone = normalized.value;
  const smsPhone = normalized.value.startsWith('0') ? '88' + normalized.value : normalized.value;

  // Verify customer exists and is a wholesaler
  const customer = await prisma.customer.findUnique({
    where: { phone: dbPhone },
    select: { id: true, type: true, name: true },
  });

  if (!customer) {
    return { success: false, error: "Account not found" };
  }

  if (customer.type !== "Wholesaler") {
    return { success: false, error: "Unauthorized: not a wholesaler" };
  }

  // Customer active status check not available in schema

  // Generate and store OTP
  const otp = generateOtp();
  const redis = getRedis();
  await redis.setex(OTP_PREFIX + dbPhone, OTP_TTL_SECONDS, otp);

  // Send SMS
  const smsResult = await sendSmsRaw(
    smsPhone,
    `Your EcoMate wholesaler portal OTP is: ${otp}. Valid for 5 minutes.`,
  );
  if (!smsResult.ok) {
    return { success: false, error: smsResult.reason || "Failed to send OTP" };
  }

  return { success: true };
}

export async function verifyWholesalerOtp(
  phone: string,
  otp: string,
): Promise<{
  success: boolean;
  error?: string;
}> {
  const normalized = normalizeBdPhoneForStorage(phone);
  if (!normalized.isValid) {
    return { success: false, error: "Invalid phone number" };
  }
  const dbPhone = normalized.value;

  const redis = getRedis();
  const storedOtp = await redis.get(OTP_PREFIX + dbPhone);

  if (!storedOtp) {
    return { success: false, error: "OTP expired or not requested" };
  }

  if (storedOtp !== otp.trim()) {
    return { success: false, error: "Invalid OTP" };
  }

  // Delete OTP after successful verification
  await redis.del(OTP_PREFIX + dbPhone);

  // Get customer
  const customer = await prisma.customer.findUnique({
    where: { phone: dbPhone },
    select: { id: true, name: true, type: true },
  });

  if (!customer || customer.type !== "Wholesaler") {
    return { success: false, error: "Unauthorized" };
  }

  // Create session
  const token = generateSessionToken();
  const tokenHash = await hashToken(token);

  const sessionData = {
    customerId: customer.id,
    name: customer.name,
    phone: dbPhone,
    createdAt: new Date().toISOString(),
  };

  await redis.setex(
    SESSION_PREFIX + tokenHash,
    SESSION_TTL_SECONDS,
    JSON.stringify(sessionData),
  );

  // Set cookie
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/wholesale",
  });

  return { success: true };
}

export async function logoutWholesaler(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    const redis = getRedis();
    const tokenHash = await hashToken(token);
    await redis.del(SESSION_PREFIX + tokenHash);
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}

// ============================================================================
// Session
// ============================================================================

export interface WholesalerSession {
  customerId: string;
  name: string;
  phone: string;
}

export async function getWholesalerSession(): Promise<WholesalerSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) return null;

  try {
    const redis = getRedis();
    const tokenHash = await hashToken(token);
    const raw = await redis.get(SESSION_PREFIX + tokenHash);

    if (!raw) return null;

    const data = JSON.parse(raw) as WholesalerSession & { createdAt: string };

    // Verify customer still exists and is wholesaler
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
      select: { id: true, type: true },
    });

    if (!customer || customer.type !== "Wholesaler") {
      await logoutWholesaler();
      return null;
    }

    return {
      customerId: data.customerId,
      name: data.name,
      phone: data.phone,
    };
  } catch {
    return null;
  }
}

export async function requireWholesalerSession(): Promise<WholesalerSession> {
  const session = await getWholesalerSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}
