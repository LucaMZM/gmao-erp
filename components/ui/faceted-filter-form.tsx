"use client";

import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useRef,
  useTransition,
} from "react";
import { useHydrated } from "@/lib/client/use-hydrated";

export type ActiveFacet = {
  key: string;
  label: string;
};

export function FacetedFilterForm({
  children,
  className = "",
  activeFilters = [],
  preserveOnClear = [],
}: {
  children: ReactNode;
  className?: string;
  activeFilters?: ActiveFacet[];
  preserveOnClear?: string[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const hydrated = useHydrated();

  const navigate = useCallback(
    (params: URLSearchParams) => {
      params.delete("page");
      const query = params.toString();
      startTransition(() =>
        router.push(query ? `${pathname}?${query}` : pathname),
      );
    },
    [pathname, router],
  );

  const submit = useCallback(() => {
    if (!formRef.current) return;
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(formRef.current)) {
      if (typeof value === "string" && value.trim()) params.append(key, value);
    }
    navigate(params);
  }, [navigate]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const remove = (key: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(key);
    navigate(params);
  };

  const clear = () => {
    const params = new URLSearchParams();
    for (const key of preserveOnClear) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    navigate(params);
  };

  return (
    <div
      className="faceted-filter-shell"
      data-hydrated={hydrated || undefined}
      data-pending={pending || undefined}
    >
      <form
        className={`filter-form ${className}`.trim()}
        method="get"
        onChange={(event) => {
          const target = event.target;
          if (
            target instanceof HTMLSelectElement ||
            (target instanceof HTMLInputElement &&
              ["checkbox", "radio"].includes(target.type))
          ) {
            submit();
          }
        }}
        onSubmit={onSubmit}
        ref={formRef}
      >
        {children}
      </form>
      {activeFilters.length ? (
        <div className="active-facet-list" aria-label="Filtros activos">
          {activeFilters.map((filter) => (
            <button
              aria-label={`Quitar filtro ${filter.label}`}
              key={filter.key}
              onClick={() => remove(filter.key)}
              type="button"
            >
              <span>{filter.label}</span>
              <X size={12} />
            </button>
          ))}
          <button className="clear-facets" onClick={clear} type="button">
            Limpiar todos
          </button>
          {pending ? (
            <span className="mini-spinner" aria-label="Actualizando filtros" />
          ) : null}
        </div>
      ) : pending ? (
        <span
          className="mini-spinner facet-spinner"
          aria-label="Actualizando filtros"
        />
      ) : null}
    </div>
  );
}
