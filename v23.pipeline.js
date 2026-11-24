/**
 * my-vue-app 迁移流水线配置
 * 顺序可调；enabled 热开关；use 可挂外部插件
 */
module.exports = {
  dryRun: true,
  preflight: true,
  pipeline: [
    { name: 'scss' },
    { name: 'less', enabled: false }, // 本项目基本不用 less，关掉
    { name: 'typescript' },
    { name: 'vuex' },
    { name: 'router' },
    { name: 'element' },
  ],
}
