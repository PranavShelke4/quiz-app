import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_RULES = [
  `At least ${PASSWORD_MIN_LENGTH} characters`,
  "One lowercase and one uppercase letter",
  "At least one number",
  "At least one symbol",
] as const;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email address"));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p), "Password needs both lowercase and uppercase letters")
  .refine((p) => /\d/.test(p), "Password needs at least one number")
  .refine((p) => /[^A-Za-z0-9]/.test(p), "Password needs at least one symbol");

export const nameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(60, "Name must be at most 60 characters")
  .regex(/^[^<>{}]*$/, "Name contains invalid characters");

export const signupSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
    team: z.string().trim().max(60).optional(),
    acceptTerms: z.literal(true, { error: "You must accept the terms to continue" }),
  })
  .refine((d) => !d.password.toLowerCase().includes(d.email.split("@")[0] ?? "\u0000"), {
    path: ["password"],
    message: "Password must not contain your email name",
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(PASSWORD_MAX_LENGTH),
});


export const tokenSchema = z.string().min(20).max(200).regex(/^[A-Za-z0-9_-]+$/);

export const resetPasswordSchema = z.object({
  token: tokenSchema,
  password: passwordSchema,
});


export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  name: nameSchema.optional(),
  team: z.string().trim().max(60).optional(),
  avatar: z
    .union([z.literal(""), z.url({ protocol: /^https$/, error: "Avatar must be an https URL" }).max(500)])
    .optional(),
});

export const adminSetupSchema = z.object({
  setupSecret: z.string().min(1),
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});
