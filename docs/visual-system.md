# Industrial Precision

Industrial Precision es la capa visual de Mazmi Factory GMAO. Conserva las estructuras y flujos industriales existentes; refuerza lectura, jerarquía y consistencia sin convertir las superficies de trabajo en decoración.

## Fundamentos

- Tema claro por defecto: canvas `#F6F7F8`, superficie `#FFFFFF`, tinta `#15171A`.
- Tema oscuro grafito: canvas `#111315`, superficie `#171A1D`, tinta `#F2F4F5`.
- Azul cobalto (`#2457D6` en claro; `#85A0F4` en oscuro) para navegación activa, foco y acción primaria. Verde, ámbar y rojo quedan reservados para estados semánticos.
- Geist Sans para interfaz y Geist Mono para identificadores técnicos. Los números operativos siguen siendo tabulares.
- Radios de 4/6/9/12 px y bordes neutros. Elevación marcada solo en menús, diálogos y drawers.

Los tokens están en `app/industrial-precision.css`, importado después de la hoja heredada. Las superficies de datos son sólidas; el shell tiene sidebar y topbar compactos, sin blur decorativo. Tablas y filtros conservan densidad con una escala tipográfica más legible. Los KPIs muestran prioridad por jerarquía, no por saturación de color.

El Planner mantiene una malla sólida de técnicos y días. En móvil se priorizan agenda, ejecución y tarjetas de dominio; no se comprimen tablas de escritorio. Reliability Center conserva señales explicables, ranking y Pareto. Procurement y Reporting comparten la misma gramática de controles y datos.

## Estados e interacción

Los controles comparten foco visible de 2 px, hover contenido y estados disabled legibles. La app respeta `prefers-reduced-motion`; no se añaden animaciones ornamentales. Los estados críticos usan texto e iconografía además de color. El selector de tema persiste la elección del usuario y, sin preferencia guardada, inicia en claro.
