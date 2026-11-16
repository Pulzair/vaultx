// Promise-based replacements for window.prompt/confirm, which are unreliable
// inside some Tauri webviews (notably macOS). Uses a native <dialog>.

function build(message: string, withInput: boolean, initial = "", okLabel = "OK"): Promise<string | null> {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    const form = document.createElement("form");
    form.method = "dialog";
    const p = document.createElement("div");
    p.textContent = message;
    p.style.marginBottom = "10px";
    form.appendChild(p);
    let input: HTMLInputElement | null = null;
    if (withInput) {
      input = document.createElement("input");
      input.className = "input";
      input.style.width = "100%";
      input.value = initial;
      form.appendChild(input);
    }
    const row = document.createElement("div");
    row.className = "row";
    row.style.justifyContent = "flex-end";
    row.style.marginTop = "14px";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn ghost";
    cancel.textContent = "Cancel";
    const ok = document.createElement("button");
    ok.className = "btn primary";
    ok.textContent = okLabel;
    row.append(cancel, ok);
    form.appendChild(row);
    dlg.appendChild(form);
    document.body.appendChild(dlg);

    let result: string | null = null;
    form.addEventListener("submit", () => {
      result = input ? input.value : "ok";
    });
    cancel.addEventListener("click", () => dlg.close());
    dlg.addEventListener("close", () => {
      dlg.remove();
      resolve(result);
    });
    dlg.showModal();
    if (input) {
      input.focus();
      input.select();
    } else {
      ok.focus();
    }
  });
}

export function askText(message: string, initial = ""): Promise<string | null> {
  return build(message, true, initial);
}

export async function askConfirm(message: string, okLabel = "Confirm"): Promise<boolean> {
  return (await build(message, false, "", okLabel)) !== null;
}
