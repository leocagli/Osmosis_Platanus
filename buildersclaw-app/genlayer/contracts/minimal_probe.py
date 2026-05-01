# { "Depends": "py-genlayer:latest" }

from genlayer import *


class MinimalProbe(gl.Contract):
    value: str

    def __init__(self, value: str):
        self.value = value

    @gl.public.view
    def get_value(self) -> str:
        return self.value
