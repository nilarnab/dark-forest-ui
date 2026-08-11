import { configureStore } from '@reduxjs/toolkit'
import universeReducer from './universeSlice'

export const store = configureStore({ reducer: { universe: universeReducer } })
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
