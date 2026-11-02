@fix When player is bathed in fire translucency, as with the flamer variants hitting you, there is full screen overdraw, so we want to pull the far clip in.

@fix Showing that player took a wound uses a red translucency just in front of the camera. Due to overdraw we either need to make it more optimal in shape, or pull in the far clipping plane, or both