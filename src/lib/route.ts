import { useEffect, useState } from "react";

/** Hash routing: a static export has no server to rewrite paths. */
export function useRoute(): string[] {
  const parse = () => (location.hash.replace(/^#\/?/, "") || "browse").split("/").filter(Boolean);
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => { setRoute(parse()); window.scrollTo(0, 0); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}
