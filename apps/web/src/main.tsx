import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { api } from './api/client'
import { Shell } from './components/Shell'
import { AccountScreen } from './screens/AccountScreen'
import { AtelierScreen } from './screens/AtelierScreen'
import { EntityEditorScreen } from './screens/EntityEditorScreen'
import { CatalogListScreen, CatalogScreen, EntityScreen } from './screens/CatalogScreens'
import { GroupLayout } from './group/GroupContext'
import { GroupSettingsScreen } from './screens/GroupSettingsScreen'
import { GroupsScreen } from './screens/GroupsScreen'
import { HomeScreen } from './screens/HomeScreen'
import { RulesetScreen } from './screens/RulesetScreen'
import { InviteScreen } from './screens/InviteScreen'
import { LoginScreen } from './screens/LoginScreen'
import { AbilitiesTab } from './screens/sheet/AbilitiesTab'
import { BreakdownScreen } from './screens/sheet/BreakdownScreen'
import { BuildScreen } from './screens/sheet/BuildScreen'
import { CharacterLayout, SheetPage } from './screens/sheet/CharacterLayout'
import { CombatTab } from './screens/sheet/CombatTab'
import { MagicTab } from './screens/sheet/MagicTab'
import { FeatsTab } from './screens/sheet/OtherTabs'
import { SkillsTab } from './screens/sheet/SkillsTab'
import { LevelUpScreen } from './screens/sheet/LevelUpScreen'
import { NewCharacterScreen } from './screens/NewCharacterScreen'
import { applyTheme, savedTheme } from './theme/theme'
import './app.css'

applyTheme(savedTheme())

const router = createBrowserRouter([
  { path: '/login', element: <LoginScreen /> },
  { path: '/invite', element: <InviteScreen /> },
  {
    element: <Shell />,
    children: [
      { index: true, element: <GroupsScreen /> },
      { path: 'account', element: <AccountScreen /> },
      { path: 'rulesets/:slug', element: <RulesetScreen /> },
      {
        // A group's pages: the catalog, characters and editor read through its RPG and rulesets.
        path: 'g/:groupId',
        element: <GroupLayout />,
        children: [
          { index: true, element: <HomeScreen /> },
          { path: 'settings', element: <GroupSettingsScreen /> },
          { path: 'characters/new', element: <NewCharacterScreen /> },
          {
            path: 'characters/:id',
            element: <CharacterLayout />,
            children: [
              {
                element: <SheetPage />,
                children: [
                  { index: true, element: <CombatTab /> },
                  { path: 'magic', element: <MagicTab /> },
                  { path: 'abilities', element: <AbilitiesTab /> },
                  { path: 'skills', element: <SkillsTab /> },
                  { path: 'feats', element: <FeatsTab /> },
                ],
              },
              { path: 'stat/:key', element: <BreakdownScreen /> },
              { path: 'build', element: <BuildScreen /> },
              { path: 'level-up', element: <LevelUpScreen /> },
            ],
          },
          { path: 'catalog', element: <CatalogScreen /> },
          { path: 'catalog/:type', element: <CatalogListScreen /> },
          { path: 'catalog/entity/:id', element: <EntityScreen /> },
          { path: 'catalog/entity/:id/edit', element: <EntityEditorScreen /> },
          { path: 'catalog/new', element: <EntityEditorScreen /> },
          { path: 'atelier', element: <AtelierScreen /> },
          { path: 'atelier/draft/:draftId', element: <EntityEditorScreen /> },
        ],
      },
    ],
  },
])

// A session that cannot be refreshed any more (expired, revoked) goes back to the login page.
api.onSignedOut = () => {
  if (!['/login', '/invite'].includes(window.location.pathname)) void router.navigate('/login', { state: { from: window.location.pathname } })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
