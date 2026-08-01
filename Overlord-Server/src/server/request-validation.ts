import type { BaseIssue, BaseSchema, InferOutput } from "valibot";
import { safeParse } from "valibot";

type ValidationIssue = {
  path?: string;
  message: string;
};

function formatIssue(issue: BaseIssue<unknown>): ValidationIssue {
  const path = issue.path
    ?.map((item) => String(item.key))
    .filter(Boolean)
    .join(".");
  return path ? { path, message: issue.message } : { message: issue.message };
}

export async function parseJsonBody<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(req: Request, schema: TSchema): Promise<InferOutput<TSchema>> {
  let input: unknown;
  try {
    input = await req.json();
  } catch {
    throw Response.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const result = safeParse(schema, input);
  if (!result.success) {
    throw Response.json(
      {
        error: "Invalid request body",
        issues: result.issues.map(formatIssue),
      },
      { status: 400 },
    );
  }

  return result.output;
}
