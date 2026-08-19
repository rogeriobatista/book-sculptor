export function ThemeInitScript() {
  const script = `(function(){try{var t=localStorage.getItem("bs-theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.setAttribute("data-theme",t);document.documentElement.style.colorScheme=t;}catch(e){}})();`;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
