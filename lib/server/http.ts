import { NextResponse } from "next/server";
import { DomainInvariantError } from "@/lib/domain/errors";
import { structuredOperationLog } from "./observability";

export class ApiContractError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiContractError";
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiContractError(
      400,
      "MALFORMED_JSON",
      "El cuerpo de la petición no contiene JSON válido.",
    );
  }
}

export async function apiErrorResponse(
  error: unknown,
  fallback: { code: string; message: string },
  requestId: string,
) {
  const auditDenied = async (code: string) => {
    try {
      const { auditDeniedAccess, getCurrentSession } = await import("./auth");
      const session = await getCurrentSession();
      if (session) await auditDeniedAccess(session, requestId, code);
    } catch {
      // Authorization failures must still return their original contract if
      // diagnostic persistence is unavailable.
    }
  };
  if (error instanceof ApiContractError) {
    structuredOperationLog({
      requestId,
      operation: "api.request",
      outcome:
        error.status === 401 || error.status === 403 ? "DENIED" : "FAILURE",
      errorClassification: error.code,
    });
    if (error.status === 403) await auditDenied(error.code);
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      },
      { status: error.status },
    );
  }

  if (error instanceof DomainInvariantError) {
    const status = error.code === "FORBIDDEN_OPERATION" ? 403 : 409;
    structuredOperationLog({
      requestId,
      operation: "api.domain-operation",
      outcome: status === 403 ? "DENIED" : "FAILURE",
      errorClassification: error.code,
    });
    if (status === 403) await auditDenied(error.code);
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      },
      { status },
    );
  }

  structuredOperationLog({
    requestId,
    operation: "api.request",
    outcome: "FAILURE",
    errorClassification: error instanceof Error ? error.name : "UNKNOWN_ERROR",
  });
  return NextResponse.json(
    {
      error: {
        code: fallback.code,
        message: fallback.message,
        requestId,
      },
    },
    { status: 500 },
  );
}
