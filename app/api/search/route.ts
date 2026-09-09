import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/server/auth";
import { apiErrorResponse } from "@/lib/server/http";
import { globalSearch } from "@/lib/server/repositories/search";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Sesión requerida.",
            requestId,
          },
        },
        { status: 401 },
      );
    }
    const query = new URL(request.url).searchParams.get("q") ?? "";
    const data = await globalSearch(
      {
        organizationId: session.organizationId,
        siteId: session.siteId,
      },
      query,
    );
    return NextResponse.json({ data, requestId });
  } catch (error) {
    return apiErrorResponse(
      error,
      {
        code: "SEARCH_FAILED",
        message: "No se ha podido completar la búsqueda.",
      },
      requestId,
    );
  }
}
