# dBet 🎲⛓️

> Un protocolo de apuestas deportivas totalmente descentralizado, automatizado y "trustless" (sin necesidad de confianza), construido sobre Ethereum y Chainlink.

## Sobre el Proyecto

**dBet** es una Aplicación Descentralizada (DApp) Web3 que redefine la experiencia de las apuestas deportivas eliminando el riesgo de contraparte y los puntos centrales de fallo. Las plataformas de apuestas tradicionales dependen de una autoridad central para custodiar los fondos y determinar el resultado de los partidos. Este protocolo sustituye ese modelo de confianza por código inmutable y verdad criptográfica.

A través de **Smart Contracts en Ethereum**, todas las apuestas y los fondos (prize pools) se gestionan completamente *on-chain* mediante un sistema Pari-Mutuel transparente. Los usuarios mantienen la autocustodia de su dinero en todo momento, y los pagos están garantizados por las matemáticas, no por una empresa corporativa.

La innovación central de este protocolo reside en su arquitectura autónoma:
* **Ciclo de vida de partidos automatizado:** Impulsado por **Chainlink Automation** (Keepers), el contrato inteligente se "despierta" de forma autónoma para programar nuevos eventos deportivos sin ninguna intervención humana.
* **Verdad Descentralizada:** Utilizando **Chainlink Functions**, el protocolo se conecta de forma segura a APIs deportivas públicas *off-chain* (ej. API-Football) para obtener tanto los próximos partidos como los resultados finales. Los datos se procesan fuera de la cadena utilizando técnicas de optimización como el empaquetado de bits (*bit-packing*) y se inyectan de forma segura *on-chain* para resolver las apuestas de forma justa.

## Características Principales

* 🚫 **Trustless y Sin Custodia:** Los contratos inteligentes gestionan todos los fondos. Ninguna entidad central puede congelar tu cuenta o bloquear tus retiradas.
* 🤖 **Totalmente Autónomo:** La creación de partidos y la resolución de resultados están completamente automatizadas a través de las Redes de Oráculos Descentralizadas (DONs) de Chainlink.
* 🔒 **Datos a prueba de manipulaciones:** Los datos deportivos externos se verifican y entregan de forma segura, haciendo que el proceso de resolución sea resistente a cualquier manipulación.
* ⚡ **Optimización de Gas:** El uso de técnicas avanzadas en Solidity, incluyendo operaciones a nivel de bits (bitwise) para desempaquetar datos y delegar la lógica condicional *off-chain*, garantiza un consumo mínimo de gas.
* 🌐 **Full-Stack Web3:** Construido con un backend robusto en Solidity (entorno Hardhat) y un frontend moderno en React/Next.js integrado con Ethers.js.

## Stack Tecnológico

* **Frontend:** Next.js 14+ (App Router), Ethers.js.
* **Smart Contracts:** Solidity 0.8.20+, Hardhat.
* **Oráculos y Automatización:** Chainlink Functions (Obtención de datos) y Chainlink Automation (Programación autónoma).
* **Arquitectura:** Modelo híbrido Web3 con optimización de datos *off-chain* mediante Bit-Packing.