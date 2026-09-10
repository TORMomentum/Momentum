"use server";

import { signIn } from "../../shared/lib/staff-session";

export interface StaffSignInState {
  accepted: boolean;
  error: string | null;
}

export async function signInAction(
  _previousState: StaffSignInState,
  formData: FormData,
): Promise<StaffSignInState> {
  const submitted = formData.get("secret");
  const accepted = typeof submitted === "string" && (await signIn(submitted));

  if (!accepted) {
    return {
      accepted: false,
      error: "ไม่อนุญาตให้เข้าถึง กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง",
    };
  }

  // The client uses this boolean only to update prototype display state and
  // navigate; the submitted secret is never returned or persisted.
  return { accepted: true, error: null };
}
