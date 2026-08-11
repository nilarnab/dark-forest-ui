import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Universe } from '../types/universe'

interface UniverseState {
  universe: Universe | null
  selectedObjectId: string | null
}

const initialState: UniverseState = { universe: null, selectedObjectId: null }

const universeSlice = createSlice({
  name: 'universe',
  initialState,
  reducers: {
    universeReceived: (state, action: PayloadAction<Universe | null>) => {
      state.universe = action.payload
    },
    selectObject: (state, action: PayloadAction<string | null>) => {
      state.selectedObjectId = action.payload
    },
  },
})

export const { universeReceived, selectObject } = universeSlice.actions
export default universeSlice.reducer
