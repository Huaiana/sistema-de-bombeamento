import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/index";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "serial");
});

describe("controle serial", () => {
  it("só habilita comandos após resposta e envia escolhas ao Arduino", async () => {
    let entrada: ReadableStreamDefaultController<Uint8Array> | undefined;
    const mensagens: string[] = [];
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        entrada = controller;
      },
    });
    const writable = new WritableStream<Uint8Array>({
      write(bytes) {
        mensagens.push(new TextDecoder().decode(bytes));
      },
    });
    const port = { readable, writable, open: vi.fn(), close: vi.fn() };
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: { requestPort: vi.fn().mockResolvedValue(port) },
    });
    const Component = Route.options.component;
    if (!Component) throw new Error("Componente da rota não encontrado");
    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: "Conectar Arduino (USB)" }));
    await waitFor(() => expect(mensagens).toContain("PING\n"));
    expect(screen.getByRole("button", { name: "Desligar e pausar" })).toBeDisabled();
    entrada?.enqueue(
      new TextEncoder().encode(
        "PROTOCOLO: 1\r\nCONTROLE: AUTOMATICO | DESCONEXAO: AUTOMATICO\r\n",
      ),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Desligar e pausar" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Desligar e pausar" }));
    fireEvent.click(screen.getByRole("button", { name: "Solicitar ligar" }));
    fireEvent.click(screen.getByRole("button", { name: "Retomar automático" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Ao perder conexão:" }), {
      target: { value: "PARAR" },
    });
    await waitFor(() => expect(mensagens).toEqual(["PING\n", "PARAR\n", "LIGAR\n", "AUTOMATICO\n", "USB_PARAR\n"]));
    entrada?.enqueue(new TextEncoder().encode("CONTROLE: PAUSADO | DESCONEXAO: PARAR\r\n"));
    await waitFor(() => expect(screen.getByText("Modo confirmado: pausado.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));
    await waitFor(() => expect(port.close).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Desligar e pausar" })).toBeDisabled();
  });
});
