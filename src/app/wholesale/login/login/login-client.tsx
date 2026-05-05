"use client";

import { useState } from "react";
import { sendOtp, verifyOtp } from "@/services/wholesale-portal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import { Loader2, Phone, ShieldCheck } from "lucide-react";

export default function WholesaleLoginClient() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSendOtp = async () => {
    setError("");
    if (!phone || phone.length < 10) {
      setError("Enter a valid phone number");
      return;
    }
    setLoading(true);
    try {
      const result = await sendOtp(phone);
      if (result.success) {
        setStep("otp");
      } else {
        setError(result.error || "Failed to send OTP");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setError("");
    if (!otp || otp.length !== 6) {
      setError("Enter the 6-digit OTP");
      return;
    }
    setLoading(true);
    try {
      const result = await verifyOtp(phone, otp);
      if (result.success) {
        router.push("/wholesale");
      } else {
        setError(result.error || "Invalid OTP");
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            {step === "phone" ? (
              <Phone className="h-7 w-7 text-primary" />
            ) : (
              <ShieldCheck className="h-7 w-7 text-primary" />
            )}
          </div>
          <CardTitle className="text-2xl font-bold">Wholesaler Portal</CardTitle>
          <CardDescription>
            {step === "phone"
              ? "Enter your registered phone number to login"
              : `Enter the OTP sent to ${phone}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === "phone" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="01XXXXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={loading}
                  maxLength={11}
                />
              </div>
              <Button className="w-full" onClick={handleSendOtp} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Send OTP
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="otp">One-Time Password</Label>
                <Input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  placeholder="000000"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  disabled={loading}
                  maxLength={6}
                  className="text-center text-2xl tracking-[0.5em] font-mono"
                />
              </div>
              <Button className="w-full" onClick={handleVerifyOtp} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Verify & Login
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setStep("phone");
                  setOtp("");
                  setError("");
                }}
                disabled={loading}
              >
                Change Phone Number
              </Button>
            </>
          )}
          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
