interface MailpitAddress {
  Address: string;
}

interface MailpitSummary {
  ID: string;
  Subject: string;
  To: MailpitAddress[];
}

interface MailpitList {
  messages?: MailpitSummary[];
  Messages?: MailpitSummary[];
}

interface MailpitMessage {
  Text: string;
}

const messagesUrl = "http://127.0.0.1:8025/api/v1/messages";

async function requireOk(response: Response, action: string): Promise<Response> {
  if (!response.ok) {
    throw new Error(`${action}: ${response.status}`);
  }

  return response;
}

export async function clearMailbox(): Promise<void> {
  const response = await fetch(messagesUrl, { method: "DELETE" });
  await requireOk(response, "Unable to clear Mailpit mailbox");
}

export async function waitForActionUrl(
  recipient: string,
  subjectPrefix: string,
): Promise<string> {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const response = await requireOk(
      await fetch(messagesUrl),
      "Unable to read Mailpit mailbox",
    );
    const body = (await response.json()) as MailpitList;
    const messages = body.messages ?? body.Messages ?? [];
    const summary = messages.find(
      (message) =>
        message.Subject.startsWith(subjectPrefix) &&
        message.To.some((address) => address.Address === recipient),
    );

    if (summary) {
      const detailResponse = await requireOk(
        await fetch(`${messagesUrl.slice(0, -1)}/${summary.ID}`),
        "Unable to read Mailpit message",
      );
      const detail = (await detailResponse.json()) as MailpitMessage;
      const match = detail.Text.match(/http:\/\/127\.0\.0\.1:3000\/[^\s]+/);

      if (!match) {
        throw new Error(`No local action URL in email ${summary.ID}`);
      }

      return match[0];
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `Timed out waiting for ${subjectPrefix} email to ${recipient}`,
  );
}
