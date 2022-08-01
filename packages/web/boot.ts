import { Editor } from "./editor";
import { safeRun } from "@silverbulletmd/common/util";
import { Space } from "@silverbulletmd/common/spaces/space";
import { HttpSpacePrimitives } from "@silverbulletmd/common/spaces/http_space_primitives";

safeRun(async () => {
  let password: string | undefined =
    localStorage.getItem("password") || undefined;

  let httpPrimitives = new HttpSpacePrimitives("", password);
  while (true) {
    try {
      await httpPrimitives.getPageMeta("index");
      break;
    } catch (e: any) {
      if (e.message === "Unauthorized") {
        password = prompt("Password: ") || undefined;
        if (!password) {
          alert("Sorry, need a password");
          return;
        }
        localStorage.setItem("password", password!);
        httpPrimitives = new HttpSpacePrimitives("", password);
      }
    }
  }
  let serverSpace = new Space(httpPrimitives, true);
  serverSpace.watch();

  console.log("Booting...");

  let editor = new Editor(serverSpace, document.getElementById("sb-root")!, "");
  await editor.init();
  // @ts-ignore
  window.editor = editor;
});

// if (!isDesktop) {
if (localStorage.getItem("disable_sw") !== "true") {
  if (navigator.serviceWorker) {
    navigator.serviceWorker
      .register(new URL("service_worker.ts", import.meta.url), {
        type: "module",
      })
      .then((r) => {
        console.log("Service worker registered...");
      });
  } else {
    console.log(
      "No launching service worker (not present, maybe because not running on localhost or over SSL)"
    );
  }
}

// }
