import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export default {
  plugins: [
    {
      postcssPlugin: 'independent-font-stylesheets',
      AtRule: {
        import(rule) {
          // A failed vendor font import must not reject Vite's lazy app CSS.
          // Fonts load independently in index.html; local font fallbacks remain.
          if (rule.params.includes('https://fonts.googleapis.com/')) rule.remove();
        },
      },
    },
    tailwindcss(),
    autoprefixer(),
  ],
};
