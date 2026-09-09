# Industrial Liquid

Industrial Liquid combina superficies de datos sólidas con navegación flotante selectivamente translúcida. La interfaz prioriza contexto industrial, estado operativo y siguiente acción útil.

## Tokens

- Canvas claro `#F2F4F2`; superficies `#FFFFFF`; tinta `#17201D`.
- Canvas oscuro `#0D1311`; superficies `#131B18`; tinta `#ECF2EF`.
- Acento verde técnico; ámbar óxido para atención; rojo mineral para criticidad; azul acero para información.
- Espaciado en múltiplos de 4; filas 48–52 px; radios 10/14/18 px.
- Números tabulares para métricas, cantidades y costes. Monoespaciada solo para códigos.

Glass se limita a sidebar, topbar flotante, command palette, popovers y drawers. Tablas, formularios y KPIs permanecen sólidos y legibles.

El Planner mantiene esta regla: la malla de técnicos y días es una superficie sólida y densa; solo los controles de semana, filtros y feedback contextual flotan. Capacidad, prioridad, origen preventivo y conflictos se diferencian por jerarquía y semántica, no mediante decoración. En móvil la malla se sustituye por una agenda personal de hoy y próximos trabajos.

Reliability Center usa una cubierta operativa jerárquica, señales accionables, ranking y Pareto. El color comunica deterioro, recurrencia y estado; las métricas sin evidencia muestran “Datos insuficientes”. RCA conserva el contexto causal en una única workspace densa y lleva las decisiones a acciones reales.

## Movimiento y accesibilidad

Hovers 120 ms, cambios 160 ms y drawers 220 ms con curva contenida. `prefers-reduced-motion` elimina desplazamiento y shimmer. Todas las acciones tienen foco visible, labels, contraste AA, landmarks y navegación por teclado. En móvil, las tablas se transforman en tarjetas de dominio y la navegación pasa a barra inferior.
