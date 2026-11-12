import starlight from '@astrojs/starlight';
import { sidebar } from './src/sidebar.generated.mjs';
import { redirects } from './src/redirects.generated.mjs';
import objc from '@shikijs/langs/objc';

export default {
  site: 'https://docs.wilddog.com',
  trailingSlash: 'ignore',
  redirects,
  integrations: [
    starlight({
      title: '野狗开发文档',
      description: '安全可靠的实时通信云文档：实时通信引擎、身份认证、短信、视频通话等',
      defaultLocale: 'zh-CN',
      locales: {
        root: { label: '简体中文', lang: 'zh-CN' },
      },
      sidebar,
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/WildDogTeam' },
      ],
      expressiveCode: {
        shiki: {
          langs: [objc],
        },
      },
    }),
  ],
};
