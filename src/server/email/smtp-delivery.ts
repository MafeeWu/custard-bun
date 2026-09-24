import nodemailer from "nodemailer";
import type { SecretConfig } from "@/server/config/schema";
import type { AuthEmailJob } from "./email-job";
import { renderAuthEmail } from "./render-auth-email";

export interface SmtpDeliveryDependencies {
  smtp: SecretConfig["smtp"];
  brandName: string;
}

export async function deliverAuthEmail(
  job: AuthEmailJob,
  dependencies: SmtpDeliveryDependencies,
): Promise<void> {
  const transport = nodemailer.createTransport({
    host: dependencies.smtp.host,
    port: dependencies.smtp.port,
    secure: dependencies.smtp.secure,
    auth: {
      user: dependencies.smtp.user,
      pass: dependencies.smtp.password,
    },
  });

  const rendered = renderAuthEmail(job, dependencies.brandName);
  await transport.sendMail({
    from: dependencies.smtp.from,
    to: job.to,
    ...rendered,
  });
}
